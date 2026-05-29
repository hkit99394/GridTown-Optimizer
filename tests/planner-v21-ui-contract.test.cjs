const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(repoRoot, "apps", "planner-web", "index.html"), "utf8");
const script = fs.readFileSync(path.join(repoRoot, "apps", "planner-web", "plannerV21.js"), "utf8");
const css = fs.readFileSync(path.join(repoRoot, "apps", "planner-web", "plannerV21.css"), "utf8");

function indexOfNeedle(needle) {
  const index = html.indexOf(needle);
  assert.notEqual(index, -1, `${needle} should be present`);
  return index;
}

function testDefaultRouteLoadsGuidedPlannerAndLegacyStaysUnadorned() {
  assert.match(html, /pathname === "\/"/);
  assert.match(html, /pathname === "\/index\.html"/);
  assert.match(html, /pathname === "\/v2\.1"/);
  assert.match(html, /plannerV21\.js/);
  assert.doesNotMatch(html, /pathname === "\/legacy"/);
}

function testStablePlannerSlotsExist() {
  const requiredSlots = [
    "stage-grid",
    "stage-catalog",
    "stage-result",
    "stage-control",
    "control-body",
    "guide-card",
    "run-rail",
    "overview-card",
    "solver-options",
    "input-library",
    "expansion-panel",
    "layout-storage",
    "result-empty",
    "result-actions",
    "result-content",
    "validation-notice",
    "result-columns",
    "result-map",
    "catalog-body",
    "catalog-grid",
    "runtime-presets"
  ];

  for (const slot of requiredSlots) {
    assert.match(html, new RegExp(`data-planner-slot="${slot}"`), `${slot} slot should exist`);
  }
}

function testResultActionTargetIsVisibleBeforeResultContent() {
  const emptyIndex = indexOfNeedle('data-planner-slot="result-empty"');
  const actionsIndex = indexOfNeedle('data-planner-slot="result-actions"');
  const contentIndex = indexOfNeedle('data-planner-slot="result-content"');
  assert.equal(emptyIndex < actionsIndex, true, "result actions should follow the empty state");
  assert.equal(actionsIndex < contentIndex, true, "result actions should be outside hidden result content");
  assert.match(script, /actionBar\.hidden = false/);
  assert.match(script, /const targets = \["#gridStage", "#controlStage", "#resultStage", "#v21ResultActions"/);
}

function testV21UsesStableSlotsForMovedPanels() {
  assert.match(script, /function bySlot/);
  for (const slot of ["guide-card", "run-rail", "overview-card", "solver-options", "result-actions"]) {
    assert.match(script, new RegExp(`bySlot\\("${slot}"\\)`), `${slot} should be addressed through bySlot`);
  }

  for (const fragileProbe of [".happy-path-card", ".launch-card", ".summary-card", ".control-card", ".storage-card"]) {
    assert.equal(script.includes(fragileProbe), false, `${fragileProbe} should not drive v2.1 panel movement`);
  }
}

function testResponsiveLayoutContracts() {
  assert.match(css, /grid-template-areas:\s*"grid control"\s*"result control"\s*"catalog control"/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*"grid"\s*"control"\s*"result"\s*"catalog"/);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.v21-result-action-bar\s*{\s*grid-template-columns: 1fr;/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*--matrix-cell-size: clamp\(17px, 4\.6vw, 23px\)/);
  assert.match(css, /min-width: 0;/);
  assert.match(css, /max-width: 100%;/);
}

testDefaultRouteLoadsGuidedPlannerAndLegacyStaysUnadorned();
testStablePlannerSlotsExist();
testResultActionTargetIsVisibleBeforeResultContent();
testV21UsesStableSlotsForMovedPanels();
testResponsiveLayoutContracts();

console.log("Planner v2.1 UI contract tests passed.");
