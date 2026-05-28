const { assert, createFakeDomElement, loadPlannerResultRenderingModule } = require("./helpers.cjs");

function createInspectorFixture({
  population,
  maxPopulation,
  serviceBonuses = [500, 401],
  pendingManualValidation = false
}) {
  const plannerResultRendering = loadPlannerResultRenderingModule();
  const residentials = Array.from({ length: 11 }, (_, index) => ({ r: index, c: 1, rows: 1, cols: 1 }));
  const populations = Array.from({ length: 11 }, () => 100);
  populations[10] = population;
  const services = [
    { r: 9, c: 0, rows: 1, cols: 1, range: 2 },
    { r: 10, c: 2, rows: 1, cols: 1, range: 1 }
  ];
  const serviceTypes = [
    { name: "Clinic", bonus: serviceBonuses[0], rows: 1, cols: 1, range: 2, avail: 1 },
    { name: "Park", bonus: serviceBonuses[1], rows: 1, cols: 1, range: 1, avail: 1 }
  ];
  const state = {
    result: {
      solution: {
        roads: [],
        services,
        serviceTypeIndices: [0, 1],
        servicePopulationIncreases: serviceBonuses,
        residentials,
        residentialTypeIndices: Array.from({ length: 11 }, () => 0),
        populations,
        totalPopulation: populations.reduce((sum, value) => sum + value, 0)
      }
    },
    resultContext: {
      params: {
        serviceTypes,
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
      isCellInsideServiceEffect(service, row, col) {
        return Boolean(
          service &&
          row >= service.r - service.range &&
          row <= service.r + service.rows - 1 + service.range &&
          col >= service.c - service.range &&
          col <= service.c + service.cols - 1 + service.range
        );
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
      lookupServiceName(typeIndex) {
        return serviceTypes[typeIndex]?.name ?? "Service";
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
    "2101 population = 1200 base + 901 service bonus, type range 1200-2160, possible improvement +59, services Clinic (S1 +500), Park (S2 +401)"
  );
}

function testInspectorOmitsResidentialPossibleImprovementAtMax() {
  const { controller, elements, solution } = createInspectorFixture({
    population: 2160,
    maxPopulation: 2160,
    serviceBonuses: [500, 600]
  });

  controller.renderSelectedBuildingDetail(solution);

  assert.equal(
    elements.selectedBuildingSummary.textContent,
    "R11 is a residential placement contributing 2160 population."
  );
  assert.equal(
    elements.selectedBuildingEffect.textContent,
    "2160 population = 1200 base + 1100 service bonus, capped at 2160, type range 1200-2160, services Clinic (S1 +500), Park (S2 +600)"
  );
}

function runPlannerResultsInspectorTests() {
  testInspectorShowsResidentialPossibleImprovement();
  testInspectorOmitsResidentialPossibleImprovementAtMax();
}

module.exports = { runPlannerResultsInspectorTests };
