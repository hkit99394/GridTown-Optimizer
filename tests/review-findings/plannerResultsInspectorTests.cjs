const { assert, createFakeDomElement, loadPlannerResultRenderingModule } = require("./helpers.cjs");

function createInspectorFixture({ population, maxPopulation, pendingManualValidation = false }) {
  const plannerResultRendering = loadPlannerResultRenderingModule();
  const residentials = Array.from({ length: 11 }, (_, index) => ({ r: index, c: 1, rows: 1, cols: 1 }));
  const populations = Array.from({ length: 11 }, () => 100);
  populations[10] = population;
  const state = {
    result: {
      solution: {
        roads: [],
        services: [],
        serviceTypeIndices: [],
        servicePopulationIncreases: [],
        residentials,
        residentialTypeIndices: Array.from({ length: 11 }, () => 0),
        populations,
        totalPopulation: populations.reduce((sum, value) => sum + value, 0)
      }
    },
    resultContext: {
      params: {
        serviceTypes: [],
        residentialTypes: [{ name: "High-density home", min: 1200, max: maxPopulation, avail: 12 }]
      }
    },
    grid: [],
    resultExplainabilityMode: "layout",
    resultHeatmapEnabled: false,
    selectedMapBuilding: { kind: "residential", index: 10 },
    selectedMapCell: null,
    isSolving: false,
    layoutEditor: { pendingValidation: pendingManualValidation }
  };
  const elements = {
    selectedBuildingTitle: createFakeDomElement(),
    selectedBuildingSummary: createFakeDomElement(),
    selectedBuildingFacts: createFakeDomElement(),
    selectedBuildingId: createFakeDomElement(),
    selectedBuildingCategory: createFakeDomElement(),
    selectedBuildingPosition: createFakeDomElement(),
    selectedBuildingFootprint: createFakeDomElement(),
    selectedBuildingEffect: createFakeDomElement(),
    selectedBuildingAvailability: createFakeDomElement()
  };
  const controller = plannerResultRendering.createPlannerResultRenderingHelpers({
    state,
    elements,
    helpers: {
      applyExplainabilityHeatmapStyle() {},
      createExplainabilityHeatmap() {
        return null;
      },
      describeExplainabilityValue() {
        return "";
      },
      findBuildingAtCell() {
        return null;
      },
      formatExplainabilityNumber(value) {
        return String(value);
      },
      getPlannerExplainabilityCell() {
        return null;
      },
      getSelectedMapCell() {
        return null;
      },
      getSelectedMapPlacement(solution) {
        return {
          kind: "residential",
          placement: solution.residentials[10],
          index: 10
        };
      },
      getTypeAvailabilitySummary() {
        return { totalAvailable: 12, used: 11, remaining: 1 };
      },
      hasPendingManualValidation() {
        return pendingManualValidation;
      },
      isCellInsidePlacement() {
        return false;
      },
      isCellInsideServiceEffect() {
        return false;
      },
      normalizeExplainabilityMode() {
        return "layout";
      },
      hidesBuildingOverlayForMode() {
        return false;
      },
      lookupResidentialName() {
        return "High-density home";
      },
      lookupServiceName() {
        return "Service";
      }
    },
    callbacks: {
      applyMatrixLayout() {},
      getOptimizerLabel(value) {
        return String(value);
      }
    }
  });

  return { controller, elements, solution: state.result.solution };
}

function testInspectorShowsResidentialPossibleImprovement() {
  const { controller, elements, solution } = createInspectorFixture({
    population: 2101,
    maxPopulation: 2160
  });

  controller.renderSelectedBuildingDetail(solution);

  assert.equal(
    elements.selectedBuildingSummary.textContent,
    "R11 is a residential placement contributing 2101 population. Possible improvement: +59 to max 2160."
  );
  assert.equal(
    elements.selectedBuildingEffect.textContent,
    "2101 population, type range 1200-2160, possible improvement +59"
  );
}

function testInspectorOmitsResidentialPossibleImprovementAtMax() {
  const { controller, elements, solution } = createInspectorFixture({
    population: 2160,
    maxPopulation: 2160
  });

  controller.renderSelectedBuildingDetail(solution);

  assert.equal(
    elements.selectedBuildingSummary.textContent,
    "R11 is a residential placement contributing 2160 population."
  );
  assert.equal(elements.selectedBuildingEffect.textContent, "2160 population, type range 1200-2160");
}

function runPlannerResultsInspectorTests() {
  testInspectorShowsResidentialPossibleImprovement();
  testInspectorOmitsResidentialPossibleImprovementAtMax();
}

module.exports = { runPlannerResultsInspectorTests };
