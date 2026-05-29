const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createFakeDomElement,
  loadPlannerDefaultsModule,
  loadPlannerOnboardingModule,
  loadPlannerSamplePresetsModule,
  loadPlannerSharedModule
} = require("./helpers/plannerBrowserModules.cjs");

const repoRoot = path.resolve(__dirname, "..");
const plannerHtmlPath = path.join(repoRoot, "apps", "planner-web", "index.html");

function readPlannerHtml() {
  return fs.readFileSync(plannerHtmlPath, "utf8");
}

function assertOrdered(haystack, needles) {
  let previousIndex = -1;
  for (const needle of needles) {
    const index = haystack.indexOf(needle);
    assert.notEqual(index, -1, `${needle} should be present`);
    assert.equal(index > previousIndex, true, `${needle} should appear after the previous marker`);
    previousIndex = index;
  }
}

function extractScriptSources(html) {
  return [...html.matchAll(/<script\s+src="([^"]+)"\s+defer><\/script>/g)].map((match) => match[1]);
}

function createClassListRecorder() {
  const toggles = [];
  return {
    toggles,
    classList: {
      toggle(name, enabled) {
        toggles.push({ enabled, name });
      }
    }
  };
}

function createEventTargetElement(overrides = {}) {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, listener) {
      listeners.push({ listener, type });
    },
    ...createFakeDomElement(overrides)
  };
}

function createReadinessFetch(payload) {
  return async (url, options) => {
    assert.equal(url, "/api/cp-sat/readiness");
    assert.deepEqual(JSON.parse(JSON.stringify(options)), { headers: { accept: "application/json" } });
    return {
      async json() {
        return payload;
      }
    };
  };
}

function testPlannerHappyPathMarkupContract() {
  const html = readPlannerHtml();

  assertOrdered(html, [
    "Input grid/catalog",
    "Run recommended Auto",
    "Inspect validated layout",
    "Save/export result",
    "Compare next expansion"
  ]);
  assert.match(html, /id="sampleProblemButtons"[^>]+aria-label="Sample problem presets"/);
  assert.match(html, /data-sample-problem="starter"/);
  assert.match(html, /data-sample-problem="open-small"/);
  assert.match(html, /data-sample-problem="corridor"/);
  assert.match(html, /id="advancedModeToggle"/);
  assert.match(html, /id="cpSatReadinessStatus"/);
  assert.match(html, /class="segmented segmented-wide advanced-only"\s+id="solverToggle"/);
  assert.match(html, /class="payload-preview advanced-only"/);

  const scripts = extractScriptSources(html);
  assert.deepEqual(scripts.slice(scripts.indexOf("/plannerDefaults.js"), scripts.indexOf("/app.js") + 1), [
    "/plannerDefaults.js",
    "/plannerSamplePresets.js",
    "/plannerOnboarding.js",
    "/plannerPersistenceValidation.js",
    "/plannerPersistence.js",
    "/plannerSolveRuntime.js",
    "/plannerExpansion.js",
    "/plannerHeatmaps.js",
    "/plannerManualLayout.js",
    "/plannerResultAvailability.js",
    "/plannerResultProgress.js",
    "/plannerResultRendering.js",
    "/plannerResults.js",
    "/plannerRequestBuilder.js",
    "/plannerWorkbench.js",
    "/app.js"
  ]);
}

function testSamplePresetLoadKeepsAutoAsHappyPathDefault() {
  const defaults = loadPlannerDefaultsModule();
  const samplePresets = loadPlannerSamplePresetsModule();
  const shared = loadPlannerSharedModule();
  const presets = samplePresets.createSampleProblemPresets({
    sampleGrid: defaults.SAMPLE_GRID,
    defaultServiceTypes: defaults.DEFAULT_SERVICE_TYPES,
    defaultResidentialTypes: defaults.DEFAULT_RESIDENTIAL_TYPES
  });
  const state = {
    expansionAdvice: {
      nextResidentialText: "Old residential",
      nextServiceText: "Old service"
    },
    grid: [[0]],
    optimizer: "greedy",
    residentialTypes: [],
    serviceTypes: []
  };

  samplePresets.applySampleProblemPreset({
    state,
    preset: presets["open-small"],
    cloneGrid: shared.cloneGrid
  });

  assert.equal(state.optimizer, "auto");
  assert.equal(state.grid.length, 8);
  assert.equal(state.grid[0].length, 8);
  assert.notEqual(state.grid, presets["open-small"].grid);
  assert.equal(state.serviceTypes.length, 2);
  assert.equal(state.residentialTypes.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(state.availableBuildings)), { residentials: "", services: "" });
  assert.equal(state.expansionAdvice.nextServiceText, "");
  assert.equal(state.expansionAdvice.nextResidentialText, "");
}

async function testOnboardingControllerHappyPathSignals() {
  const body = createClassListRecorder();
  const plannerOnboarding = loadPlannerOnboardingModule({
    context: {
      fetch: createReadinessFetch({
        ok: true,
        cpSat: {
          pythonExecutable: "/planner/.venv-cp-sat/bin/python",
          ready: true
        }
      })
    },
    window: {
      document: {
        body
      }
    }
  });
  const defaults = loadPlannerDefaultsModule();
  const samplePresets = loadPlannerSamplePresetsModule();
  const shared = loadPlannerSharedModule();
  const presets = samplePresets.createSampleProblemPresets({
    sampleGrid: defaults.SAMPLE_GRID,
    defaultServiceTypes: defaults.DEFAULT_SERVICE_TYPES,
    defaultResidentialTypes: defaults.DEFAULT_RESIDENTIAL_TYPES
  });
  const elements = {
    advancedModeToggle: createEventTargetElement(),
    cpSatReadinessStatus: createFakeDomElement(),
    runtimePresetStatus: createFakeDomElement(),
    sampleProblemButtons: createEventTargetElement()
  };
  const state = {
    advancedMode: false,
    expansionAdvice: {
      nextResidentialText: "",
      nextServiceText: ""
    },
    grid: [[0]],
    optimizer: "greedy",
    residentialTypes: [],
    serviceTypes: []
  };
  let solveStateMessage = "";
  let syncCount = 0;
  const controller = plannerOnboarding.createPlannerOnboardingController({
    state,
    elements,
    sampleProblemPresets: presets,
    helpers: {
      cloneGrid: shared.cloneGrid
    },
    callbacks: {
      setSolveState(message) {
        solveStateMessage = message;
      },
      syncPlannerFromState() {
        syncCount += 1;
      }
    }
  });

  controller.setAdvancedMode(true);
  assert.equal(state.advancedMode, true);
  assert.equal(elements.advancedModeToggle.checked, true);
  assert.deepEqual(body.toggles.at(-1), { enabled: true, name: "advanced-mode" });

  await controller.refreshCpSatReadiness();
  assert.equal(elements.cpSatReadinessStatus.textContent, "CP-SAT ready via /planner/.venv-cp-sat/bin/python.");

  controller.loadSampleProblem("corridor");
  assert.equal(state.optimizer, "auto");
  assert.equal(state.grid.length, 8);
  assert.equal(state.grid[0].length, 10);
  assert.equal(syncCount, 1);
  assert.equal(elements.runtimePresetStatus.textContent, 'Loaded "Corridor pressure" with Auto selected.');
  assert.equal(solveStateMessage, elements.runtimePresetStatus.textContent);
}

async function main() {
  testPlannerHappyPathMarkupContract();
  testSamplePresetLoadKeepsAutoAsHappyPathDefault();
  await testOnboardingControllerHappyPathSignals();
  console.log("Planner happy path smoke tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
