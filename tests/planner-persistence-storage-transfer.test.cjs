const assert = require("node:assert/strict");

const { createFakeDomElement, loadPlannerPersistenceModule } = require("./helpers/plannerBrowserModules.cjs");

function createFakeLocalStorage(initialEntries = []) {
  const storage = new Map(initialEntries);
  return {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    }
  };
}

function createPersistenceHarness(initialEntries = []) {
  const localStorage = createFakeLocalStorage(initialEntries);
  const plannerPersistence = loadPlannerPersistenceModule(localStorage);
  const constants = {
    CONFIG_STORAGE_KEY: "configs",
    LAYOUT_STORAGE_KEY: "layouts",
    defaultResidentialTypes: [],
    defaultServiceTypes: [],
    sampleGrid: [[1]]
  };
  let nextId = 1;
  const elements = {
    savedLayoutsSelect: createFakeDomElement(),
    layoutStorageName: createFakeDomElement(),
    layoutStorageStatus: createFakeDomElement(),
    savedConfigsSelect: createFakeDomElement(),
    configStorageName: createFakeDomElement(),
    configStorageStatus: createFakeDomElement()
  };
  const persistence = plannerPersistence.createPlannerPersistence({
    state: {
      isSolving: false,
      selectedMapBuilding: null,
      selectedMapCell: null,
      layoutEditor: { mode: "inspect", pendingPlacement: null, edited: false, pendingValidation: false },
      result: null,
      resultContext: null,
      solveProgressLog: [],
      resultIsLiveSnapshot: false,
      resultError: "",
      optimizer: "greedy",
      grid: [[1]],
      serviceTypes: [],
      residentialTypes: [],
      availableBuildings: { services: "", residentials: "" },
      greedy: {},
      cpSat: {},
      lns: {},
      auto: { wallClockLimitSeconds: "" }
    },
    elements,
    constants,
    helpers: {
      buildCpSatWarmStartCheckpoint() {
        return null;
      },
      cloneGrid(value) {
        return JSON.parse(JSON.stringify(value));
      },
      cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
      },
      createSavedEntryId() {
        return `generated-${nextId++}`;
      },
      formatElapsedTime(value) {
        return String(value);
      },
      formatSavedTimestamp(value) {
        return String(value);
      },
      getSavedLayoutElapsedMs(entry) {
        return entry.elapsedMs ?? 0;
      },
      isGridLike(value) {
        return Array.isArray(value);
      },
      normalizeElapsedMs(value) {
        return Number(value) || 0;
      },
      normalizeOptimizer(value) {
        return value === "auto" || value === "lns" || value === "cp-sat" ? value : "greedy";
      }
    },
    callbacks: {
      applySolveRequestToPlanner() {},
      clearExpansionAdvice() {},
      clearRenderedResultState() {},
      renderResults() {},
      resetSolveTimer() {},
      setResultElapsed() {},
      setSolveState() {},
      syncPlannerFromState() {}
    }
  });
  return { constants, elements, localStorage, persistence };
}

function readEntries(localStorage, key) {
  return JSON.parse(localStorage.getItem(key) || "[]");
}

function testSavedLayoutImportMergesByIdAndGeneratesMissingIds() {
  const existingLayouts = [
    {
      id: "layout-1",
      name: "Downtown",
      savedAt: "2026-05-01T00:00:00.000Z",
      result: { population: 10 },
      resultContext: { optimizer: "auto" }
    }
  ];
  const { constants, elements, localStorage, persistence } = createPersistenceHarness([
    ["layouts", JSON.stringify(existingLayouts)]
  ]);

  const summary = persistence.importSavedLayoutsFromText(
    JSON.stringify({
      schemaVersion: 1,
      kind: "city-builder.planner-layouts.v1",
      layouts: [
        {
          id: "layout-1",
          name: "Downtown refreshed",
          savedAt: "2026-05-02T00:00:00.000Z",
          result: { population: 20 },
          resultContext: { optimizer: "cp-sat" }
        },
        {
          name: "Imported west side",
          result: { population: 30 },
          resultContext: { optimizer: "lns" }
        }
      ]
    })
  );

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), { added: 1, updated: 1, total: 2, selectedId: "layout-1" });
  const layouts = readEntries(localStorage, constants.LAYOUT_STORAGE_KEY);
  assert.equal(layouts.length, 2);
  assert.equal(layouts.find((entry) => entry.id === "layout-1").result.population, 20);
  assert.equal(layouts.find((entry) => entry.id === "generated-1").name, "Imported west side");
  assert.match(elements.layoutStorageStatus.textContent, /1 new, 1 updated/);
}

function testSavedConfigImportAcceptsRawArrayAndPreservesStorageOnInvalidJson() {
  const existingConfigs = [
    {
      id: "config-1",
      name: "Current input",
      savedAt: "2026-05-01T00:00:00.000Z",
      snapshot: { grid: [[1]] }
    }
  ];
  const { constants, elements, localStorage, persistence } = createPersistenceHarness([
    ["configs", JSON.stringify(existingConfigs)]
  ]);

  assert.equal(persistence.importSavedConfigsFromText("{not json"), null);
  assert.deepEqual(readEntries(localStorage, constants.CONFIG_STORAGE_KEY), existingConfigs);
  assert.match(elements.configStorageStatus.textContent, /Could not import/);

  const summary = persistence.importSavedConfigsFromText(
    JSON.stringify([
      {
        name: "Imported input",
        snapshot: { grid: [[1, 1]] }
      }
    ])
  );

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), { added: 1, updated: 0, total: 1, selectedId: "generated-1" });
  const configs = readEntries(localStorage, constants.CONFIG_STORAGE_KEY);
  assert.equal(configs.length, 2);
  assert.equal(configs[0].id, "generated-1");
  assert.equal(configs[0].name, "Imported input");
  assert.match(elements.configStorageStatus.textContent, /1 new, 0 updated/);
}

testSavedLayoutImportMergesByIdAndGeneratesMissingIds();
testSavedConfigImportAcceptsRawArrayAndPreservesStorageOnInvalidJson();
console.log("Planner persistence storage transfer tests passed.");
