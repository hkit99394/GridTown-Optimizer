const { assert, createFakeDomElement, loadPlannerResultsModule } = require("./helpers.cjs");

function testPlannerResultsUsesPlannerExplainabilityRiskLayer() {
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
    element.classList = {
      add(value) {
        element.className = `${element.className || ""} ${value}`.trim();
      },
      remove() {},
      toggle() {}
    };
    return element;
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
  const cells = [
    [
      {
        r: 0,
        c: 0,
        allowed: true,
        occupiedKind: "service",
        roadAnchorReachable: false,
        roadAnchorDistance: null,
        serviceValue: 0,
        bestServiceBonus: 0,
        residentialOpportunity: 0,
        residentialHeadroom: 0,
        connectivityLostCells: 0,
        connectivityDisconnectedCells: 0,
        connectivityFootprintCells: 0
      },
      {
        r: 0,
        c: 1,
        allowed: true,
        occupiedKind: null,
        roadAnchorReachable: true,
        roadAnchorDistance: 0,
        serviceValue: 20,
        bestServiceBonus: 10,
        residentialOpportunity: 30,
        residentialHeadroom: 20,
        connectivityLostCells: 0,
        connectivityDisconnectedCells: 0,
        connectivityFootprintCells: 0
      },
      {
        r: 0,
        c: 2,
        allowed: true,
        occupiedKind: null,
        roadAnchorReachable: true,
        roadAnchorDistance: 0,
        serviceValue: 0,
        bestServiceBonus: 40,
        residentialOpportunity: 0,
        residentialHeadroom: 0,
        connectivityLostCells: 0,
        connectivityDisconnectedCells: 0,
        connectivityFootprintCells: 0
      }
    ],
    [
      {
        r: 1,
        c: 0,
        allowed: true,
        occupiedKind: "road",
        roadAnchorReachable: true,
        roadAnchorDistance: 1,
        serviceValue: 20,
        bestServiceBonus: 0,
        residentialOpportunity: 0,
        residentialHeadroom: 0,
        connectivityLostCells: 4,
        connectivityDisconnectedCells: 4,
        connectivityFootprintCells: 1
      },
      {
        r: 1,
        c: 1,
        allowed: true,
        occupiedKind: "residential",
        roadAnchorReachable: false,
        roadAnchorDistance: null,
        serviceValue: 20,
        bestServiceBonus: 0,
        residentialOpportunity: 0,
        residentialHeadroom: 0,
        connectivityLostCells: 0,
        connectivityDisconnectedCells: 0,
        connectivityFootprintCells: 0
      },
      {
        r: 1,
        c: 2,
        allowed: true,
        occupiedKind: null,
        roadAnchorReachable: true,
        roadAnchorDistance: 2,
        serviceValue: 0,
        bestServiceBonus: 0,
        residentialOpportunity: 0,
        residentialHeadroom: 0,
        connectivityLostCells: 0,
        connectivityDisconnectedCells: 0,
        connectivityFootprintCells: 0
      }
    ]
  ];
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
      explainability: {
        schemaVersion: 1,
        rows: 2,
        cols: 3,
        maxServiceValue: 20,
        maxBestServiceBonus: 40,
        maxResidentialOpportunity: 30,
        maxResidentialHeadroom: 20,
        maxConnectivityLostCells: 4,
        maxConnectivityDisconnectedCells: 4,
        roadAnchorReachableCellCount: 4,
        cells
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
    resultHeatmapEnabled: false,
    resultExplainabilityMode: "connectivity-risk",
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
  const riskCell = findCell(1, 0);

  assert.match(serviceCell.className, /service/);
  assert.doesNotMatch(serviceCell.className, /empty/);
  assert.match(riskCell.className, /road/);
  assert.match(riskCell.className, /heatmap-cell/);
  assert.match(riskCell.className, /connectivity-risk-heatmap-cell/);
  assert.equal(riskCell.dataset.connectivityRisk, "4");
  assert.match(riskCell.title, /connectivity risk 4 cells/);
  assert.equal(elements.resultOverlay.children.length, 2);

  state.resultExplainabilityMode = "placement-opportunity";
  elements.resultMapGrid.children = [];
  elements.resultOverlay.children = [];
  controller.renderResults();

  const serviceOnlyCell = findCell(0, 2);
  assert.match(serviceOnlyCell.className, /placement-opportunity-heatmap-cell/);
  assert.equal(serviceOnlyCell.dataset.placementOpportunity, "40");
  assert.match(serviceOnlyCell.title, /best remaining service \+40/);
  assert.doesNotMatch(serviceOnlyCell.title, /residential up to 40/);
}

function testPlannerResultsAppliesPlacementOpportunityMap() {
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
      [1, 1, 1],
      [1, 1, 1]
    ],
    result: {
      solution: {
        optimizer: "greedy",
        roads: ["2,0"],
        services: [{ r: 0, c: 0, rows: 1, cols: 1, range: 1 }],
        serviceTypeIndices: [0],
        servicePopulationIncreases: [20],
        residentials: [],
        residentialTypeIndices: [],
        populations: [],
        totalPopulation: 0
      },
      stats: {
        optimizer: "greedy",
        manualLayout: false,
        cpSatStatus: null,
        stoppedByUser: false,
        stoppedByTimeLimit: false,
        totalPopulation: 0,
        roadCount: 1,
        serviceCount: 1,
        residentialCount: 0
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
        optimizer: "greedy",
        serviceTypes: [{ name: "Clinic", bonus: 20, rows: 1, cols: 1, range: 1, avail: 1 }],
        residentialTypes: [{ name: "House", w: 1, h: 1, min: 10, max: 25, avail: 1 }]
      }
    },
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    resultElapsedMs: 1000,
    resultExplainabilityMode: "placement-opportunity",
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
  const roadCell = findCell(2, 0);
  const farCell = findCell(2, 2);

  assert.doesNotMatch(serviceCell.className, /heatmap-cell/);
  assert.match(coveredCell.className, /placement-opportunity-heatmap-cell/);
  assert.equal(coveredCell.dataset.placementOpportunity, "25");
  assert.match(coveredCell.title, /placement opportunity 25/);
  assert.match(coveredCell.title, /House 1x1/);
  assert.doesNotMatch(roadCell.className, /heatmap-cell/);
  assert.match(farCell.className, /placement-opportunity-heatmap-cell/);
  assert.equal(farCell.dataset.placementOpportunity, "10");
  assert.equal(elements.resultOverlay.children.length, 1);
}

function testPlannerResultsAppliesConnectivityRiskMap() {
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
  const grid = [
    [0, 0, 0, 0],
    [1, 1, 1, 0],
    [1, 0, 1, 1]
  ];
  const state = {
    isSolving: false,
    grid,
    result: {
      solution: {
        optimizer: "greedy",
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
        optimizer: "greedy",
        manualLayout: false,
        cpSatStatus: null,
        stoppedByUser: false,
        stoppedByTimeLimit: false,
        totalPopulation: 0,
        roadCount: 0,
        serviceCount: 0,
        residentialCount: 0
      },
      validation: {
        valid: true,
        errors: []
      }
    },
    resultContext: {
      grid,
      params: {
        optimizer: "greedy",
        serviceTypes: [],
        residentialTypes: []
      }
    },
    solveProgressLog: [],
    resultIsLiveSnapshot: false,
    resultError: "",
    resultElapsedMs: 1000,
    resultExplainabilityMode: "connectivity-risk",
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
  const leftColumnChoke = findCell(1, 1);
  const safeAnchor = findCell(2, 0);
  const blockedCell = findCell(0, 1);

  assert.match(leftColumnChoke.className, /connectivity-risk-heatmap-cell/);
  assert.equal(leftColumnChoke.dataset.connectivityRisk, "3");
  assert.match(leftColumnChoke.title, /connectivity risk 3 cells/);
  assert.doesNotMatch(safeAnchor.className, /heatmap-cell/);
  assert.doesNotMatch(blockedCell.className, /heatmap-cell/);
  assert.equal(elements.resultOverlay.children.length, 0);
}

function runPlannerResultsExplainabilityTests() {
  testPlannerResultsUsesPlannerExplainabilityRiskLayer();
  testPlannerResultsAppliesPlacementOpportunityMap();
  testPlannerResultsAppliesConnectivityRiskMap();
}

module.exports = { runPlannerResultsExplainabilityTests };
