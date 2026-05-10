const { assert, createFakeDomElement, loadPlannerResultsModule } = require("./helpers.cjs");

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

function runPlannerResultsLayoutEditorTests() {
  testPlannerResultsRotatePendingPlacementUpdatesFootprint();
}

module.exports = { runPlannerResultsLayoutEditorTests };
