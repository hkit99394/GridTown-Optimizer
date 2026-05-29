/**
 * @param {Window & { CityBuilderSamplePresets?: unknown }} globalObject
 */
(function attachPlannerSamplePresets(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {number[][]} PlannerGrid
   * @typedef {{ label: string, grid: PlannerGrid, serviceTypes: JsonObject[], residentialTypes: JsonObject[], availableBuildings: { services: string, residentials: string } }} SampleProblemPreset
   */

  /**
   * @param {{ sampleGrid: PlannerGrid, defaultServiceTypes: JsonObject[], defaultResidentialTypes: JsonObject[] }} options
   * @returns {Record<string, SampleProblemPreset>}
   */
  function createSampleProblemPresets({ sampleGrid, defaultServiceTypes, defaultResidentialTypes }) {
    return {
      starter: {
        label: "Starter sample",
        grid: sampleGrid,
        serviceTypes: defaultServiceTypes,
        residentialTypes: defaultResidentialTypes,
        availableBuildings: { services: "", residentials: "" }
      },
      "open-small": {
        label: "Open 8 x 8",
        grid: Array.from({ length: 8 }, () => Array(8).fill(1)),
        serviceTypes: [
          { name: "Clinic", bonus: "80", size: "2x2", effective: "5x5", avail: "1" },
          { name: "Park", bonus: "120", size: "2x3", effective: "6x6", avail: "1" }
        ],
        residentialTypes: [
          { name: "Townhouse", resident: "120/360", size: "2x2", avail: "4" },
          { name: "Corner Apartments", resident: "220/660", size: "2x3", avail: "2" }
        ],
        availableBuildings: { services: "", residentials: "" }
      },
      corridor: {
        label: "Corridor pressure",
        grid: [
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 0, 0, 1, 1, 1, 1],
          [1, 1, 1, 1, 0, 0, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 0, 0, 1, 1, 1, 1],
          [1, 1, 1, 1, 0, 0, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
        ],
        serviceTypes: [
          { name: "Transit Hub", bonus: "210", size: "2x2", effective: "7x7", avail: "1" },
          { name: "School", bonus: "130", size: "2x2", effective: "5x6", avail: "1" },
          { name: "Market", bonus: "170", size: "3x2", effective: "7x6", avail: "1" }
        ],
        residentialTypes: [
          { name: "Courtyard Homes", resident: "160/480", size: "2x2", avail: "4" },
          { name: "Corridor Flats", resident: "320/960", size: "2x3", avail: "3" }
        ],
        availableBuildings: { services: "", residentials: "" }
      }
    };
  }

  /**
   * @param {{ state: JsonObject, preset: SampleProblemPreset, cloneGrid: (grid: PlannerGrid) => PlannerGrid }} options
   */
  function applySampleProblemPreset({ state, preset, cloneGrid }) {
    state.grid = cloneGrid(preset.grid);
    state.serviceTypes = preset.serviceTypes.map((entry) => ({ ...entry }));
    state.residentialTypes = preset.residentialTypes.map((entry) => ({ ...entry }));
    state.availableBuildings = { ...preset.availableBuildings };
    state.optimizer = "auto";
    state.expansionAdvice.nextServiceText = "";
    state.expansionAdvice.nextResidentialText = "";
  }

  globalObject.CityBuilderSamplePresets = Object.freeze({
    applySampleProblemPreset,
    createSampleProblemPresets
  });
})(window);
