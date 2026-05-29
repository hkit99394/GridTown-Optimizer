const {
  assert,
  createFakeDomElement,
  loadPlannerManualLayoutModule,
  loadPlannerResultsModule
} = require("./helpers.cjs");

function createRecordingElement(overrides = {}) {
  const element = createFakeDomElement({
    attributes: {},
    children: [],
    style: {
      setProperty(name, value) {
        this[name] = value;
      }
    },
    append(...children) {
      this.children.push(...children);
    },
    appendChild(child) {
      this.children.push(child);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    ...overrides
  });
  let innerHTML = "";
  Object.defineProperty(element, "innerHTML", {
    get() {
      return innerHTML;
    },
    set(value) {
      innerHTML = String(value);
      element.children = [];
    }
  });
  return element;
}

function testPlannerResultsRotatePendingPlacementUpdatesFootprint() {
  const plannerResults = loadPlannerResultsModule();
  const state = {
    isSolving: false,
    grid: [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1]
    ],
    result: {
      solution: {
        roads: [],
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials: [],
        residentialTypeIndices: [],
        populations: [],
        totalPopulation: 0
      },
      stats: {
        manualLayout: false
      },
      validation: {
        valid: true,
        errors: []
      }
    },
    resultContext: {
      grid: [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1]
      ],
      params: {
        serviceTypes: [{ name: "Depot", rows: 2, cols: 3, range: 1, bonus: 10, avail: 1 }],
        residentialTypes: []
      }
    },
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    selectedMapBuilding: null,
    selectedMapCell: null,
    layoutEditor: {
      mode: "inspect",
      pendingPlacement: null,
      isApplying: false,
      edited: false,
      pendingValidation: false,
      status: ""
    }
  };
  const modeButtons = [
    createFakeDomElement({ dataset: { layoutEditMode: "inspect" } }),
    createFakeDomElement({ dataset: { layoutEditMode: "place-service" } })
  ];
  const elements = {
    layoutEditModeToggle: {
      querySelectorAll() {
        return modeButtons;
      }
    },
    layoutEditorStatus: createFakeDomElement(),
    rotatePendingPlacementButton: createFakeDomElement()
  };
  const controller = plannerResults.createPlannerResultsController({
    state,
    elements,
    helpers: {
      cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
      },
      formatElapsedTime(value) {
        return String(value);
      }
    },
    callbacks: {
      applyMatrixLayout() {},
      clearExpansionAdvice() {},
      getOptimizerLabel(value) {
        return String(value);
      },
      renderExpansionAdvice() {},
      setSolveState() {},
      syncActionAvailability() {}
    }
  });

  controller.setLayoutEditMode("place-service", {
    kind: "service",
    typeIndex: 0,
    name: "Depot",
    rows: 2,
    cols: 3,
    rotated: false,
    canRotate: true
  });

  assert.match(elements.layoutEditorStatus.textContent, /Depot \(2x3\)/);
  assert.equal(elements.rotatePendingPlacementButton.textContent, "Rotate 90°");

  controller.handleRotatePendingPlacementAction();

  assert.equal(state.layoutEditor.pendingPlacement.rotated, true);
  assert.match(elements.layoutEditorStatus.textContent, /Depot \(3x2\)/);
  assert.equal(elements.rotatePendingPlacementButton.textContent, "Use original orientation");
}

function testManualLayoutClipsCorruptFootprintHelpersToGrid() {
  const plannerManualLayout = loadPlannerManualLayoutModule();
  const state = {
    resultContext: {
      grid: [
        [1, 1],
        [1, 1]
      ]
    }
  };
  const model = plannerManualLayout.createPlannerManualLayoutModel({
    state,
    cloneJson(value) {
      return JSON.parse(JSON.stringify(value));
    },
    pendingManualLayoutError: "pending"
  });

  const cells = model.footprintCellsForPlacement({ r: 0, c: 0, rows: 1000000, cols: 1000000 });

  assert.equal(
    JSON.stringify(cells.map((cell) => `${cell.r},${cell.c}`)),
    JSON.stringify(["0,0", "0,1", "1,0", "1,1"])
  );
}

function testPlannerResultsRenderClipsCorruptPlacementGeometry() {
  const plannerResults = loadPlannerResultsModule({
    window: {
      getComputedStyle() {
        return {
          getPropertyValue(name) {
            if (name === "--matrix-cell-size") return "20";
            if (name === "--matrix-gap") return "2";
            return "";
          },
          paddingLeft: "0",
          paddingTop: "0"
        };
      }
    },
    context: {
      document: {
        createElement() {
          return createRecordingElement();
        }
      }
    }
  });
  const grid = [
    [1, 1],
    [1, 1]
  ];
  const state = {
    isSolving: false,
    grid,
    result: {
      solution: {
        optimizer: "greedy",
        roads: [],
        services: [{ r: 0, c: 0, rows: 1000000, cols: 1000000, range: 0 }],
        serviceTypeIndices: [0],
        servicePopulationIncreases: [10],
        residentials: [],
        residentialTypeIndices: [],
        populations: [],
        totalPopulation: 0
      },
      stats: {
        optimizer: "greedy",
        manualLayout: true,
        cpSatStatus: null,
        stoppedByUser: false,
        stoppedByTimeLimit: false,
        totalPopulation: 0,
        roadCount: 0,
        serviceCount: 1,
        residentialCount: 0
      },
      validation: {
        valid: false,
        errors: ["Service at (0,0) size 1000000x1000000 extends beyond the grid (2x2)."]
      }
    },
    resultContext: {
      grid,
      params: {
        optimizer: "greedy",
        serviceTypes: [{ name: "Clinic", bonus: 10, rows: 1, cols: 1, range: 0, avail: 1 }],
        residentialTypes: []
      }
    },
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    resultElapsedMs: 1000,
    resultExplainabilityMode: "layout",
    resultHeatmapEnabled: false,
    selectedMapBuilding: null,
    selectedMapCell: null,
    layoutEditor: {
      mode: "inspect",
      pendingPlacement: null,
      isApplying: false,
      edited: false,
      pendingValidation: false,
      status: ""
    }
  };
  const elements = new Proxy(
    {},
    {
      get(target, key) {
        if (!target[key]) target[key] = createRecordingElement();
        return target[key];
      }
    }
  );
  const controller = plannerResults.createPlannerResultsController({
    state,
    elements,
    helpers: {
      cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
      },
      formatElapsedTime(value) {
        return `${value}ms`;
      }
    },
    callbacks: {
      applyMatrixLayout() {},
      clearExpansionAdvice() {},
      getOptimizerLabel(value) {
        return String(value);
      },
      renderExpansionAdvice() {},
      setSolveState() {},
      syncActionAvailability() {}
    }
  });

  controller.renderResults();

  assert.equal(elements.resultMapGrid.children.length, 4);
  assert(elements.resultMapGrid.children.every((cell) => /service/.test(cell.className)));
  assert.equal(elements.resultOverlay.children.length, 1);
  assert(Number.parseFloat(elements.resultOverlay.children[0].style.width) < 100);
}

function runPlannerResultsLayoutEditorTests() {
  testPlannerResultsRotatePendingPlacementUpdatesFootprint();
  testManualLayoutClipsCorruptFootprintHelpersToGrid();
  testPlannerResultsRenderClipsCorruptPlacementGeometry();
}

module.exports = { runPlannerResultsLayoutEditorTests };
