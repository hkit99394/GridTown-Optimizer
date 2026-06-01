const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const scripts = packageJson.scripts;

function testGovernanceScriptExistsAndStaysFocused() {
  assert.equal(typeof scripts["format:docs:check"], "string");
  assert.match(scripts["format:docs:check"], /prettier --check/);
  assert.match(scripts["format:docs:check"], /docs\/\*\*\/\*\.md/);

  assert.equal(typeof scripts["quality:governance"], "string");
  assert.match(scripts["quality:governance"], /npm run format:docs:check/);
  assert.match(scripts["quality:governance"], /npm run artifact-hygiene:status/);
  assert.match(scripts["quality:governance"], /npm run candidate-intake:check/);
  assert.match(scripts["quality:governance"], /node tests\/candidate-trigger-scaffold\.test\.cjs/);
  assert.doesNotMatch(scripts["quality:governance"], /npm run build/);
  assert.doesNotMatch(scripts["quality:governance"], /benchmark:scorecard/);
}

function testEvidenceGateCoversGovernanceScriptContract() {
  assert.match(scripts["quality:evidence"], /node tests\/governance-scripts\.test\.cjs/);
}

testGovernanceScriptExistsAndStaysFocused();
testEvidenceGateCoversGovernanceScriptContract();
console.log("Governance script tests passed.");
