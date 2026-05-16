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
  const state = {
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
  };
  const persistence = plannerPersistence.createPlannerPersistence({
    state,
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
  return { constants, elements, localStorage, persistence, state };
}

function readEntries(localStorage, key) {
  return JSON.parse(localStorage.getItem(key) || "[]");
}

function createSerializedSolution(totalPopulation) {
  return {
    roads: [],
    services: [],
    serviceTypeIndices: [],
    servicePopulationIncreases: [],
    residentials: [],
    residentialTypeIndices: [],
    populations: [],
    totalPopulation
  };
}

function createSavedResult(totalPopulation) {
  return {
    solution: createSerializedSolution(totalPopulation),
    validation: {
      valid: true,
      errors: [],
      recomputedPopulations: [],
      recomputedTotalPopulation: totalPopulation,
      mapRows: [],
      mapText: ""
    },
    stats: {
      manualLayout: false,
      optimizer: "greedy",
      cpSatStatus: null,
      stoppedByUser: false,
      stoppedByTimeLimit: false,
      totalPopulation,
      roadCount: 0,
      serviceCount: 0,
      residentialCount: 0
    }
  };
}

function createResultContext(params = { optimizer: "greedy" }) {
  return {
    grid: [[1]],
    params
  };
}

function testSavedLayoutImportMergesByIdAndGeneratesMissingIds() {
  const existingLayouts = [
    {
      id: "layout-1",
      name: "Downtown",
      savedAt: "2026-05-01T00:00:00.000Z",
      result: createSavedResult(10),
      resultContext: createResultContext({ optimizer: "auto" })
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
          result: createSavedResult(20),
          resultContext: createResultContext({ optimizer: "cp-sat" })
        },
        {
          name: "Imported west side",
          result: createSavedResult(30),
          resultContext: createResultContext({ optimizer: "lns" })
        }
      ]
    })
  );

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), { added: 1, updated: 1, total: 2, selectedId: "layout-1" });
  const layouts = readEntries(localStorage, constants.LAYOUT_STORAGE_KEY);
  assert.equal(layouts.length, 2);
  assert.equal(layouts.find((entry) => entry.id === "layout-1").result.solution.totalPopulation, 20);
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

function testSavedConfigImportRejectsInvalidSnapshotsAndPreservesStorage() {
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

  assert.equal(
    persistence.importSavedConfigsFromText(
      JSON.stringify({
        configs: [
          {
            name: "Malformed input",
            snapshot: {
              grid: [[2]],
              serviceTypes: ["not an object"]
            }
          }
        ]
      })
    ),
    null
  );

  assert.deepEqual(readEntries(localStorage, constants.CONFIG_STORAGE_KEY), existingConfigs);
  assert.match(elements.configStorageStatus.textContent, /did not contain valid/);
}

function testSavedConfigImportRejectsMalformedCatalogObjectsAndPreservesStorage() {
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

  assert.equal(
    persistence.importSavedConfigsFromText(
      JSON.stringify({
        configs: [
          {
            name: "Missing catalog fields",
            snapshot: {
              grid: [[1]],
              serviceTypes: [{}]
            }
          },
          {
            name: "Malformed residential fields",
            snapshot: {
              grid: [[1]],
              residentialTypes: [{ name: "Tower", resident: "120/360" }]
            }
          }
        ]
      })
    ),
    null
  );

  assert.deepEqual(readEntries(localStorage, constants.CONFIG_STORAGE_KEY), existingConfigs);
  assert.match(elements.configStorageStatus.textContent, /did not contain valid/);
}

function testSavedConfigImportAcceptsOmittedCatalogArrays() {
  const { constants, elements, localStorage, persistence } = createPersistenceHarness();

  const summary = persistence.importSavedConfigsFromText(
    JSON.stringify({
      configs: [
        {
          name: "Legacy input without catalogs",
          snapshot: {
            grid: [[1, 1]],
            optimizer: "greedy"
          }
        }
      ]
    })
  );

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), { added: 1, updated: 0, total: 1, selectedId: "generated-1" });
  const configs = readEntries(localStorage, constants.CONFIG_STORAGE_KEY);
  assert.equal(configs.length, 1);
  assert.deepEqual(configs[0].snapshot, { grid: [[1, 1]], optimizer: "greedy" });
  assert.match(elements.configStorageStatus.textContent, /1 new, 0 updated/);
}

function testSavedLayoutImportRejectsInvalidResultsAndPreservesStorage() {
  const existingLayouts = [
    {
      id: "layout-1",
      name: "Downtown",
      savedAt: "2026-05-01T00:00:00.000Z",
      result: createSavedResult(10),
      resultContext: createResultContext()
    }
  ];
  const { constants, elements, localStorage, persistence } = createPersistenceHarness([
    ["layouts", JSON.stringify(existingLayouts)]
  ]);

  assert.equal(
    persistence.importSavedLayoutsFromText(
      JSON.stringify({
        layouts: [
          {
            name: "Malformed layout",
            result: {
              solution: {
                roads: ["1,"],
                services: [],
                serviceTypeIndices: [],
                servicePopulationIncreases: [],
                residentials: [],
                residentialTypeIndices: [],
                populations: [],
                totalPopulation: 0
              }
            },
            resultContext: createResultContext()
          }
        ]
      })
    ),
    null
  );

  assert.deepEqual(readEntries(localStorage, constants.LAYOUT_STORAGE_KEY), existingLayouts);
  assert.match(elements.layoutStorageStatus.textContent, /did not contain valid/);
}

function testLoadSelectedConfigRejectsCorruptStoredSnapshots() {
  const { elements, persistence, state } = createPersistenceHarness([
    [
      "configs",
      JSON.stringify([
        {
          id: "config-1",
          name: "Corrupt input",
          savedAt: "2026-05-01T00:00:00.000Z",
          snapshot: { grid: "not a grid" }
        }
      ])
    ]
  ]);

  elements.savedConfigsSelect.value = "config-1";
  persistence.loadSelectedConfig();

  assert.deepEqual(state.grid, [[1]]);
  assert.equal(state.resultContext, null);
  assert.match(elements.configStorageStatus.textContent, /invalid/);
}

function testLoadSelectedLayoutRejectsCorruptStoredResults() {
  const { elements, persistence, state } = createPersistenceHarness([
    [
      "layouts",
      JSON.stringify([
        {
          id: "layout-1",
          name: "Corrupt layout",
          savedAt: "2026-05-01T00:00:00.000Z",
          result: {
            solution: {
              roads: ["0,0"],
              services: [],
              serviceTypeIndices: [0],
              servicePopulationIncreases: [],
              residentials: [],
              residentialTypeIndices: [],
              populations: [],
              totalPopulation: 0
            }
          },
          resultContext: createResultContext()
        }
      ])
    ]
  ]);

  elements.savedLayoutsSelect.value = "layout-1";
  persistence.loadSelectedLayout();

  assert.equal(state.result, null);
  assert.equal(state.resultContext, null);
  assert.match(elements.layoutStorageStatus.textContent, /invalid/);
}

testSavedLayoutImportMergesByIdAndGeneratesMissingIds();
testSavedConfigImportAcceptsRawArrayAndPreservesStorageOnInvalidJson();
testSavedConfigImportRejectsInvalidSnapshotsAndPreservesStorage();
testSavedConfigImportRejectsMalformedCatalogObjectsAndPreservesStorage();
testSavedConfigImportAcceptsOmittedCatalogArrays();
testSavedLayoutImportRejectsInvalidResultsAndPreservesStorage();
testLoadSelectedConfigRejectsCorruptStoredSnapshots();
testLoadSelectedLayoutRejectsCorruptStoredResults();
console.log("Planner persistence storage transfer tests passed.");
