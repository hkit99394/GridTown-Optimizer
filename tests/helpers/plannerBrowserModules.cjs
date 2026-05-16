const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..", "..");

function createFakeDomElement(overrides = {}) {
  return {
    value: "",
    checked: false,
    hidden: false,
    textContent: "",
    innerHTML: "",
    dataset: {},
    style: {
      setProperty() {}
    },
    parentElement: null,
    append() {},
    appendChild() {},
    setAttribute() {},
    querySelectorAll() {
      return [];
    },
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    ...overrides
  };
}

function loadBrowserModule(repoRelativePath, options = {}) {
  const { window = {}, context: extraContext = {} } = options;
  const source = fs.readFileSync(path.resolve(repoRoot, repoRelativePath), "utf8");
  const sandbox = {
    window,
    JSON,
    Math,
    Date,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    Set,
    Map,
    Promise,
    ...extraContext
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window;
}

function loadPlannerSharedModule() {
  return loadBrowserModule("apps/planner-web/plannerShared.js", {
    window: {
      setTimeout,
      clearTimeout
    }
  }).CityBuilderShared;
}

function loadPlannerRequestBuilderModule(crypto = undefined) {
  return loadBrowserModule("apps/planner-web/plannerRequestBuilder.js", {
    window: {
      crypto,
      CityBuilderShared: loadPlannerSharedModule()
    },
    context: {
      Uint32Array,
      Error
    }
  }).CityBuilderRequestBuilder;
}

function loadPlannerExpansionModule(fetch) {
  return loadBrowserModule("apps/planner-web/plannerExpansion.js", {
    context: {
      Error,
      fetch,
      URLSearchParams
    }
  }).CityBuilderExpansion;
}

function loadPlannerWorkbenchModule() {
  class ResizeObserver {
    observe() {}
    disconnect() {}
  }
  return loadBrowserModule("apps/planner-web/plannerWorkbench.js", {
    window: {
      CityBuilderShared: loadPlannerSharedModule()
    },
    context: {
      document: {
        createElement() {
          return createFakeDomElement();
        }
      },
      ResizeObserver
    }
  }).CityBuilderWorkbench;
}

function loadPlannerSolveRuntimeModule() {
  return loadBrowserModule("apps/planner-web/plannerSolveRuntime.js", {
    window: {
      clearInterval,
      setInterval
    },
    context: {
      Error
    }
  }).CityBuilderSolveRuntime;
}

function loadPlannerShellModule() {
  return loadBrowserModule("apps/planner-web/plannerShell.js").CityBuilderShell;
}

function loadPlannerHeatmapsModule() {
  return loadBrowserModule("apps/planner-web/plannerHeatmaps.js").PlannerHeatmaps;
}

function loadPlannerPersistenceValidationModule() {
  return loadBrowserModule("apps/planner-web/plannerPersistenceValidation.js").CityBuilderPersistenceValidation;
}

function loadPlannerManualLayoutModule() {
  return loadBrowserModule("apps/planner-web/plannerManualLayout.js").PlannerManualLayout;
}

function loadPlannerResultProgressModule(options = {}) {
  return loadBrowserModule("apps/planner-web/plannerResultProgress.js", options).PlannerResultProgress;
}

function loadPlannerResultRenderingModule(options = {}) {
  return loadBrowserModule("apps/planner-web/plannerResultRendering.js", options).PlannerResultRendering;
}

function loadPlannerResultsModule(options = {}) {
  return loadBrowserModule("apps/planner-web/plannerResults.js", {
    ...options,
    window: {
      PlannerHeatmaps: loadPlannerHeatmapsModule(),
      PlannerManualLayout: loadPlannerManualLayoutModule(),
      PlannerResultProgress: loadPlannerResultProgressModule(options),
      PlannerResultRendering: loadPlannerResultRenderingModule(options),
      ...(options.window ?? {})
    }
  }).CityBuilderResults;
}

function loadPlannerPersistenceModule(localStorage = undefined) {
  return loadBrowserModule("apps/planner-web/plannerPersistence.js", {
    window: {
      localStorage,
      CityBuilderPersistenceValidation: loadPlannerPersistenceValidationModule()
    },
    context: {
      document: {
        createElement() {
          return createFakeDomElement();
        }
      }
    }
  }).CityBuilderPersistence;
}

module.exports = {
  createFakeDomElement,
  loadPlannerExpansionModule,
  loadPlannerPersistenceModule,
  loadPlannerPersistenceValidationModule,
  loadPlannerResultProgressModule,
  loadPlannerResultRenderingModule,
  loadPlannerRequestBuilderModule,
  loadPlannerResultsModule,
  loadPlannerSharedModule,
  loadPlannerShellModule,
  loadPlannerSolveRuntimeModule,
  loadPlannerWorkbenchModule
};
