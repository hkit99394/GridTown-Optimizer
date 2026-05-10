const { assert, createFakeDomElement, loadPlannerResultsModule } = require("./helpers.cjs");

function testPlannerResultsAppliesServiceValueHeatmap() {
  function createRecordingElement(overrides = {}) {
    return createFakeDomElement({
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
  }

  const plannerResults = loadPlannerResultsModule({
    window: {
      getComputedStyle() {
        return {
          getPropertyValue() {
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
  const state = {
    isSolving: false,
    grid: [
      [1, 1, 1],
      [1, 1, 1]
    ],
    result: {
      solution: {
        optimizer: "greedy",
        roads: ["1,0"],
        services: [{ r: 0, c: 0, rows: 1, cols: 1, range: 1 }],
        serviceTypeIndices: [0],
        servicePopulationIncreases: [20],
        residentials: [{ r: 1, c: 1, rows: 1, cols: 1 }],
        residentialTypeIndices: [0],
        populations: [30],
        totalPopulation: 30
      },
      stats: {
        optimizer: "greedy",
        manualLayout: false,
        cpSatStatus: null,
        stoppedByUser: false,
        stoppedByTimeLimit: false,
        totalPopulation: 30,
        roadCount: 1,
        serviceCount: 1,
        residentialCount: 1
      },
      validation: {
        valid: true,
        errors: []
      }
    },
    resultContext: {
      grid: [
        [1, 1, 1],
        [1, 1, 1]
      ],
      params: {
        optimizer: "greedy",
        serviceTypes: [{ name: "Clinic", bonus: 20, rows: 1, cols: 1, range: 1, avail: 1 }],
        residentialTypes: [{ name: "House", w: 1, h: 1, min: 10, max: 30, avail: 1 }]
      }
    },
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    resultElapsedMs: 1000,
    resultHeatmapEnabled: true,
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
        return value === "greedy" ? "Greedy" : String(value);
      },
      renderExpansionAdvice() {},
      setSolveState() {},
      syncActionAvailability() {}
    }
  });

  controller.renderResults();

  const findCell = (row, col) =>
    elements.resultMapGrid.children.find((cell) => cell.dataset.r === String(row) && cell.dataset.c === String(col));
  const serviceCell = findCell(0, 0);
  const coveredCell = findCell(0, 1);
  const roadCell = findCell(1, 0);
  const residentialCell = findCell(1, 1);
  const farCell = findCell(1, 2);

  assert.match(serviceCell.className, /empty/);
  assert.doesNotMatch(serviceCell.className, /service/);
  assert.doesNotMatch(serviceCell.className, /heatmap-cell/);
  assert.doesNotMatch(serviceCell.title, /Clinic|service/);
  assert.match(coveredCell.className, /heatmap-cell/);
  assert.equal(coveredCell.dataset.serviceValue, "20");
  assert.equal(coveredCell.style["--heatmap-warm-alpha"], "0.76");
  assert.match(coveredCell.title, /service value \+20/);
  assert.match(coveredCell.attributes["aria-label"], /service value \+20/);
  assert.match(roadCell.className, /empty/);
  assert.doesNotMatch(roadCell.className, /road/);
  assert.match(roadCell.className, /heatmap-cell/);
  assert.doesNotMatch(roadCell.title, /road/);
  assert.match(residentialCell.className, /empty/);
  assert.doesNotMatch(residentialCell.className, /residential/);
  assert.match(residentialCell.className, /heatmap-cell/);
  assert.doesNotMatch(residentialCell.title, /House|residential/);
  assert.doesNotMatch(farCell.className, /heatmap-cell/);
  assert.equal(elements.resultOverlay.children.length, 0);
}

function runPlannerResultsHeatmapTests() {
  testPlannerResultsAppliesServiceValueHeatmap();
}

module.exports = { runPlannerResultsHeatmapTests };
