const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

const baseArgs = [
  "scripts/scaffold-candidate-trigger.mjs",
  "--trigger-id=manual-resume-runtime-sla",
  "--candidate-id=auto-manual-resume-runtime-sla",
  "--source=Product SLA requires strict subsecond manual-resume solve completion",
  "--date=2026-06-02",
  "--artifact-path=artifacts/product-corpus/2026-06-02/manual-resume-runtime-sla",
  "--cases=fresh-manual-resume-neighborhood",
  "--workflow-tags=manual-resume-neighborhood,manual-layout-replay",
  "--modes=auto",
  "--budgets=1",
  "--seeds=7,19,37",
  "--objective=equal population with faster time-to-best"
];

function runScaffold(args) {
  return childProcess.spawnSync(process.execPath, [...baseArgs, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function runIntakeCheck(filePath) {
  return childProcess.spawnSync(process.execPath, ["scripts/check-candidate-intakes.mjs", `--files=${filePath}`], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function testScaffoldPrintsLedgerRecordAndIntakeDraft() {
  const result = runScaffold([]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /# Candidate Trigger Nomination Packet/);
  assert.match(result.stdout, /### manual-resume-runtime-sla/);
  assert.match(result.stdout, /# Solver Candidate Intake: auto-manual-resume-runtime-sla/);
  assert.match(result.stdout, /MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER\.md/);
  assert.match(result.stdout, /npm run artifact-hygiene:status/);
  assert.match(result.stdout, /Baseline-repeat command/);
  assert.match(result.stdout, /npm run candidate-intake:check/);
}

function testScaffoldWritesCheckableIntakeDraft() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-trigger-scaffold-"));
  try {
    const result = runScaffold([`--out-dir=${dir}`, "--write-intake", "--json"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.triggerId, "manual-resume-runtime-sla");
    assert.equal(payload.candidateId, "auto-manual-resume-runtime-sla");
    assert.match(payload.intakePath, /M9_CANDIDATE_INTAKE_AUTO_MANUAL_RESUME_RUNTIME_SLA\.md$/);

    const absoluteIntakePath = path.join(repoRoot, payload.intakePath);
    assert.equal(fs.existsSync(absoluteIntakePath), true);

    const check = runIntakeCheck(absoluteIntakePath);
    assert.equal(check.status, 0, check.stderr || check.stdout);
    assert.match(check.stdout, /1 M15-enforced/);

    const duplicate = runScaffold([`--out-dir=${dir}`, "--write-intake"]);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /Refusing to overwrite/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

testScaffoldPrintsLedgerRecordAndIntakeDraft();
testScaffoldWritesCheckableIntakeDraft();
console.log("Candidate trigger scaffold tests passed.");
