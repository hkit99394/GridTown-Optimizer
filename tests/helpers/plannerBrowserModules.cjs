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
    click() {},
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

function loadPlannerDefaultsModule() {
  return loadBrowserModule("apps/planner-web/plannerDefaults.js").CityBuilderDefaults;
}

function loadPlannerSamplePresetsModule() {
  return loadBrowserModule("apps/planner-web/plannerSamplePresets.js").CityBuilderSamplePresets;
}

function loadPlannerOnboardingModule(options = {}) {
  return loadBrowserModule("apps/planner-web/plannerOnboarding.js", {
    ...options,
    window: {
      CityBuilderSamplePresets: loadPlannerSamplePresetsModule(),
      ...(options.window ?? {})
    }
  }).CityBuilderOnboarding;
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
    window: {
      CityBuilderShared: loadPlannerSharedModule()
    },
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
      CityBuilderShared: loadPlannerSharedModule(),
      CityBuilderWorkbenchCatalog: loadPlannerWorkbenchCatalogModule()
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

function loadPlannerResultDiagnosticsModule(options = {}) {
  return loadBrowserModule("apps/planner-web/plannerResultDiagnostics.js", options).PlannerResultDiagnostics;
}

function loadPlannerResultAvailabilityModule(options = {}) {
  return loadBrowserModule("apps/planner-web/plannerResultAvailability.js", options).PlannerResultAvailability;
}

function loadPlannerResultRenderingModule(options = {}) {
  return loadBrowserModule("apps/planner-web/plannerResultRendering.js", {
    ...options,
    window: {
      PlannerResultDiagnostics: loadPlannerResultDiagnosticsModule(options),
      ...(options.window ?? {})
    }
  }).PlannerResultRendering;
}

function loadPlannerResultStatesModule(options = {}) {
  return loadBrowserModule("apps/planner-web/plannerResultStates.js", options).PlannerResultStates;
}

function loadPlannerWorkbenchCatalogModule(options = {}) {
  return loadBrowserModule("apps/planner-web/plannerWorkbenchCatalog.js", options).CityBuilderWorkbenchCatalog;
}

function loadPlannerResultsModule(options = {}) {
  return loadBrowserModule("apps/planner-web/plannerResults.js", {
    ...options,
    window: {
      PlannerHeatmaps: loadPlannerHeatmapsModule(),
      PlannerManualLayout: loadPlannerManualLayoutModule(),
      PlannerResultAvailability: loadPlannerResultAvailabilityModule(options),
      PlannerResultProgress: loadPlannerResultProgressModule(options),
      PlannerResultRendering: loadPlannerResultRenderingModule(options),
      PlannerResultStates: loadPlannerResultStatesModule(options),
      ...(options.window ?? {})
    }
  }).CityBuilderResults;
}

function loadPlannerPersistenceModule(localStorage = undefined, browserApis = {}) {
  const { URL: urlApi, createElement, Blob: BlobConstructor = globalThis.Blob } = browserApis;
  return loadBrowserModule("apps/planner-web/plannerPersistence.js", {
    window: {
      localStorage,
      URL: urlApi,
      CityBuilderPersistenceValidation: loadPlannerPersistenceValidationModule()
    },
    context: {
      Blob: BlobConstructor,
      document: {
        createElement() {
          return typeof createElement === "function" ? createElement() : createFakeDomElement();
        }
      }
    }
  }).CityBuilderPersistence;
}

module.exports = {
  createFakeDomElement,
  loadPlannerDefaultsModule,
  loadPlannerExpansionModule,
  loadPlannerManualLayoutModule,
  loadPlannerOnboardingModule,
  loadPlannerPersistenceModule,
  loadPlannerPersistenceValidationModule,
  loadPlannerResultAvailabilityModule,
  loadPlannerResultDiagnosticsModule,
  loadPlannerResultProgressModule,
  loadPlannerResultRenderingModule,
  loadPlannerResultStatesModule,
  loadPlannerRequestBuilderModule,
  loadPlannerResultsModule,
  loadPlannerSamplePresetsModule,
  loadPlannerSharedModule,
  loadPlannerShellModule,
  loadPlannerSolveRuntimeModule,
  loadPlannerWorkbenchCatalogModule,
  loadPlannerWorkbenchModule
};
