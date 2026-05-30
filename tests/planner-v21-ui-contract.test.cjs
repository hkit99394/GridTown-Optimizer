const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(repoRoot, "apps", "planner-web", "index.html"), "utf8");
const previewBootScript = fs.readFileSync(path.join(repoRoot, "apps", "planner-web", "plannerPreviewBoot.js"), "utf8");
const script = fs.readFileSync(path.join(repoRoot, "apps", "planner-web", "plannerV21.js"), "utf8");
const shellScript = fs.readFileSync(path.join(repoRoot, "apps", "planner-web", "plannerShell.js"), "utf8");
const css = fs.readFileSync(path.join(repoRoot, "apps", "planner-web", "plannerV21.css"), "utf8");

function indexOfNeedle(needle) {
  const index = html.indexOf(needle);
  assert.notEqual(index, -1, `${needle} should be present`);
  return index;
}

function testDefaultRouteLoadsGuidedPlannerAndLegacyStaysUnadorned() {
  assert.match(html, /plannerPreviewBoot\.js/);
  assert.match(previewBootScript, /pathname === "\/"/);
  assert.match(previewBootScript, /pathname === "\/index\.html"/);
  assert.match(previewBootScript, /pathname === "\/v2\.1"/);
  assert.match(previewBootScript, /plannerV21\.js/);
  assert.doesNotMatch(previewBootScript, /pathname === "\/legacy"/);
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

function loadShellModule(plannerVersion) {
  const window = {
    document: {
      documentElement: {
        dataset: {
          plannerVersion
        }
      }
    }
  };
  const sandbox = {
    window,
    Object,
    String,
    Boolean
  };
  vm.createContext(sandbox);
  vm.runInContext(shellScript, sandbox);
  return window.CityBuilderShell;
}

function createShellControl(overrides = {}) {
  return {
    disabled: false,
    textContent: "",
    ...overrides
  };
}

function createToggleContainer() {
  return {
    querySelectorAll() {
      return [];
    }
  };
}

function createShellHarness(plannerVersion = "v2.1") {
  let hasAnyCandidate = false;
  const shell = loadShellModule(plannerVersion);
  const state = {
    optimizer: "auto",
    isSolving: false,
    activeSolveRequestId: "",
    isStopping: false,
    result: null,
    resultContext: null,
    layoutEditor: {
      edited: false,
      isApplying: false,
      pendingValidation: false,
      pendingPlacement: null
    },
    expansionAdvice: {
      isRunning: false
    }
  };
  const elements = {
    solveButton: createShellControl(),
    stopSolveButton: createShellControl(),
    loadConfigButton: createShellControl(),
    loadLayoutButton: createShellControl(),
    saveLayoutButton: createShellControl(),
    lnsUseDisplayedSeed: createShellControl(),
    cpSatUseDisplayedHint: createShellControl(),
    expansionNextService: createShellControl(),
    expansionNextResidential: createShellControl(),
    compareExpansionButton: createShellControl(),
    moveSelectedBuildingButton: createShellControl(),
    removeSelectedBuildingButton: createShellControl(),
    rotatePendingPlacementButton: createShellControl(),
    validateEditedLayoutButton: createShellControl(),
    layoutEditModeToggle: createToggleContainer(),
    remainingServiceList: createToggleContainer(),
    remainingResidentialList: createToggleContainer(),
    solveStatus: {
      textContent: ""
    }
  };
  const controller = shell.createPlannerShellController({
    state,
    elements,
    callbacks: {
      hasSelectedBuilding: () => false,
      readExpansionCandidateFlags: () => ({ hasAnyCandidate })
    }
  });
  return {
    controller,
    elements,
    shell,
    state,
    setHasAnyCandidate(value) {
      hasAnyCandidate = value;
    }
  };
}

function testV21PrimaryCtaLabelComesFromShellState() {
  const harness = createShellHarness("v2.1");

  harness.controller.syncActionAvailability();
  assert.equal(harness.elements.solveButton.textContent, "Run Auto");

  harness.state.optimizer = "lns";
  harness.controller.syncActionAvailability();
  assert.equal(harness.elements.solveButton.textContent, "Run LNS");

  harness.state.isSolving = true;
  harness.state.activeSolveRequestId = "solve-1";
  harness.controller.syncActionAvailability();
  assert.equal(harness.elements.solveButton.textContent, "Solving...");
}

function testLegacyAndV2KeepLegacyShellCta() {
  for (const plannerVersion of ["", "v2"]) {
    const harness = createShellHarness(plannerVersion);
    harness.state.optimizer = "cp-sat";
    harness.controller.syncActionAvailability();
    assert.equal(harness.elements.solveButton.textContent, "Run solver");
  }
}

function testV21ResultActionsFollowShellAvailability() {
  const harness = createShellHarness("v2.1");
  const viewStates = [];
  harness.shell.registerViewContract({
    sync(viewState) {
      viewStates.push(viewState);
    }
  });

  harness.controller.syncActionAvailability();
  assert.equal(viewStates.at(-1).resultActions.saveDisabled, true);
  assert.equal(viewStates.at(-1).resultActions.exportDisabled, true);
  assert.equal(viewStates.at(-1).resultActions.compareDisabled, true);
  assert.match(viewStates.at(-1).resultActions.statusText, /Run Auto or load a saved layout/);

  harness.state.result = { solution: {} };
  harness.state.resultContext = { params: {} };
  harness.controller.syncActionAvailability();
  assert.equal(viewStates.at(-1).resultActions.saveDisabled, false);
  assert.equal(viewStates.at(-1).resultActions.exportDisabled, false);
  assert.equal(viewStates.at(-1).resultActions.compareDisabled, true);

  harness.setHasAnyCandidate(true);
  harness.controller.syncActionAvailability();
  assert.equal(viewStates.at(-1).resultActions.compareDisabled, false);
  assert.match(viewStates.at(-1).resultActions.statusText, /ready for save, export, or expansion comparison/);

  harness.state.isSolving = true;
  harness.state.activeSolveRequestId = "solve-1";
  harness.controller.syncActionAvailability();
  assert.equal(viewStates.at(-1).resultActions.saveDisabled, true);
  assert.equal(viewStates.at(-1).resultActions.exportDisabled, true);
  assert.equal(viewStates.at(-1).resultActions.compareDisabled, true);
}

function testV21DelegatesCtaAndResultActionReadinessToShellContract() {
  assert.match(shellScript, /registerViewContract/);
  assert.match(shellScript, /primaryCtaLabel/);
  assert.match(script, /registerViewContract\(\{ sync \}\)/);
  assert.doesNotMatch(script, /function syncRunButtonLabel/);
  assert.doesNotMatch(script, /solveButton\.textContent/);
  assert.doesNotMatch(script, /new MutationObserver\(sync\)\.observe\(document\.body/);
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
testV21PrimaryCtaLabelComesFromShellState();
testLegacyAndV2KeepLegacyShellCta();
testV21ResultActionsFollowShellAvailability();
testV21DelegatesCtaAndResultActionReadinessToShellContract();
testResponsiveLayoutContracts();

console.log("Planner v2.1 UI contract tests passed.");
