const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function runCheck(files, extraArgs = []) {
  return childProcess.spawnSync(
    process.execPath,
    ["scripts/check-candidate-intakes.mjs", `--files=${files.join(",")}`, ...extraArgs],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );
}

function issuesFromJsonResult(result) {
  const summary = JSON.parse(result.stdout);
  return summary.checks.flatMap((check) => check.issues);
}

function writeFixture(dir, fileName, content) {
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function validM15Intake() {
  return `# Solver Candidate Intake: test-post-m15-candidate

Date: 2026-06-02

Owner: Test

Status: proposed

Candidate type: diagnostics

Runtime default change proposed now: no

## Trigger

Trigger source:

- [MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md](MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md): trigger-test-row is admitted for a focused diagnostics slice.

Observed problem:

- Case(s): test-row
- Split(s): development and fresh holdout
- Workflow tag(s): service-pressure
- Budget(s): 1
- Seed(s): 7,19,37
- Mode(s): auto
- Current behavior: current artifact shows a repeatable outside-envelope gap.
- Artifact path(s): artifacts/product-corpus/2026-06-02/test-trigger

## Hypothesis

Candidate hypothesis:

- If we test the admitted trigger,
- Then it may explain the gap,
- Because the baseline-repeat envelope is known.

## Evidence Plan

Baseline controls:

- Baseline freshness command: npm run benchmark:scorecard -- --product-corpus --modes=auto --budgets=1 --seeds=7,19,37 test-row
- Baseline-repeat command: same command with a baseline-repeat run id.
- Candidate same-slice command: same cases, budgets, seeds, and hardware with the candidate enabled.

Evaluator and replay gates:

- Final-layout evaluator-validity plan: npm run evidence:candidate-evaluator-validity -- --candidate-id=test-post-m15-candidate
- Replay workflow plan: replay rows must keep zero validation errors.

Artifact hygiene preflight:

- Run npm run artifact-hygiene:status before broad evidence. Current soft-warning requires an externalization plan if broad raw bundles are produced.

## Artifact Policy

Artifact root:

- artifacts/product-corpus/2026-06-02/test-post-m15-candidate

Expected files to keep in git when small:

- Summary text: yes.
- Evidence summary: yes.
- Telemetry manifest: yes.
- Registry entry draft: yes.

Expected files to move to release/external storage if large:

- Raw scorecard JSON: yes.
- Budget ablation JSON: yes.
- Decision trace JSONL: yes.
- Replay labels: yes.
- Solve logs: yes.

Registry plan:

- Registry entry required: yes.
`;
}

function ledgerLinkedActiveIntake() {
  return validM15Intake()
    .replace("Date: 2026-06-02", "Date: 2026-05-31")
    .replace("Status: proposed", "Status: intake-ready");
}

function m15IntakeMissingArtifactPreflight() {
  return validM15Intake().replace(
    `
Artifact hygiene preflight:

- Run npm run artifact-hygiene:status before broad evidence. Current soft-warning requires an externalization plan if broad raw bundles are produced.
`,
    "\n"
  );
}

function m15IntakeMissingExternalStoragePlan() {
  return validM15Intake().replace(
    `
Expected files to move to release/external storage if large:

- Raw scorecard JSON: yes.
- Budget ablation JSON: yes.
- Decision trace JSONL: yes.
- Replay labels: yes.
- Solve logs: yes.
`,
    "\n"
  );
}

function invalidM15Intake() {
  return `# Solver Candidate Intake: bad-post-m15-candidate

Date: 2026-06-02

Owner: Test

Status: proposed

Candidate type: diagnostics

Runtime default change proposed now: no

## Trigger

Trigger source:

- TBD.

Observed problem:

- Case(s): test-row

## Evidence Plan

Baseline controls:

- Baseline freshness command: npm run benchmark:scorecard
`;
}

function legacyClosedIntake() {
  return `# Solver Candidate Intake: legacy-closed-candidate

Date: 2026-05-31

Owner: Test

Status: closed diagnostics-only

Candidate type: diagnostics

Runtime default change proposed now: no

## Trigger

Trigger source:

- Historical artifact before M15 trigger-ledger enforcement.

Observed problem:

- Case(s): legacy-row
`;
}

function testValidM15IntakePasses() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-intake-check-"));
  try {
    const file = writeFixture(dir, "M9_CANDIDATE_INTAKE_VALID.md", validM15Intake());
    const result = runCheck([file]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /1 M15-enforced/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testLedgerLinkedActiveIntakePasses() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-intake-check-"));
  try {
    const file = writeFixture(dir, "M9_CANDIDATE_INTAKE_ACTIVE.md", ledgerLinkedActiveIntake());
    const result = runCheck([file], ["--json"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.m15EnforcedCount, 1);
    assert.equal(summary.legacyAcceptedCount, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testMissingArtifactPreflightFails() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-intake-check-"));
  try {
    const file = writeFixture(dir, "M9_CANDIDATE_INTAKE_MISSING_PREFLIGHT.md", m15IntakeMissingArtifactPreflight());
    const result = runCheck([file], ["--json"]);
    assert.notEqual(result.status, 0);
    const issues = issuesFromJsonResult(result);
    assert.deepEqual(issues, ["M15 gate requires an artifact hygiene preflight using npm run artifact-hygiene:status"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testMissingExternalStoragePlanFails() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-intake-check-"));
  try {
    const file = writeFixture(dir, "M9_CANDIDATE_INTAKE_MISSING_STORAGE.md", m15IntakeMissingExternalStoragePlan());
    const result = runCheck([file], ["--json"]);
    assert.notEqual(result.status, 0);
    const issues = issuesFromJsonResult(result);
    assert.deepEqual(issues, ["M15 gate requires release/external storage expectations for large raw evidence"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testInvalidM15IntakeFails() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-intake-check-"));
  try {
    const file = writeFixture(dir, "M9_CANDIDATE_INTAKE_INVALID.md", invalidM15Intake());
    const result = runCheck([file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /real trigger source/);
    assert.match(result.stderr, /artifact hygiene preflight/);
    assert.match(result.stderr, /baseline-repeat/);
    assert.match(result.stderr, /evaluator-validity/);
    assert.match(result.stderr, /Artifact Policy/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testLegacyClosedIntakeIsAccepted() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-intake-check-"));
  try {
    const file = writeFixture(dir, "M9_CANDIDATE_INTAKE_LEGACY.md", legacyClosedIntake());
    const result = runCheck([file], ["--json"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.m15EnforcedCount, 0);
    assert.equal(summary.legacyAcceptedCount, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

testValidM15IntakePasses();
testLedgerLinkedActiveIntakePasses();
testMissingArtifactPreflightFails();
testMissingExternalStoragePlanFails();
testInvalidM15IntakeFails();
testLegacyClosedIntakeIsAccepted();
console.log("Candidate intake check tests passed.");
