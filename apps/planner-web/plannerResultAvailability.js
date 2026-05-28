/**
 * @param {Window & { PlannerResultAvailability?: unknown }} globalObject
 */
(function attachPlannerResultAvailability(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {{ populations: number[], residentials: JsonObject[], residentialTypeIndices: number[], roads: string[], servicePopulationIncreases: number[], services: JsonObject[], serviceTypeIndices: number[] }} ResultSolution
   * @typedef {{ totalAvailable: number, used: number, remaining: number }} TypeAvailabilitySummary
   * @typedef {{ resultContext?: JsonObject | null }} AvailabilityState
   */

  /**
   * @param {JsonObject | null | undefined} type
   * @param {boolean} isService
   */
  function getTypeTotalAvailable(type, isService) {
    const fallback = isService ? 1 : 0;
    const rawAvailable = type?.avail ?? fallback;
    const parsedAvailable = Number(rawAvailable);
    return Number.isFinite(parsedAvailable) ? Math.max(0, Math.floor(parsedAvailable)) : fallback;
  }

  /**
   * @param {{ state: AvailabilityState }} options
   */
  function createPlannerResultAvailabilityHelpers(options) {
    const { state } = options;

    /**
     * @param {unknown} typeIndices
     * @param {number} typeCount
     */
    function countPlacementsByType(typeIndices, typeCount) {
      const counts = Array.from({ length: Math.max(0, typeCount) }, () => 0);
      if (!Array.isArray(typeIndices)) return counts;
      typeIndices.forEach((typeIndex) => {
        if (Number.isInteger(typeIndex) && typeIndex >= 0 && typeIndex < counts.length) {
          counts[typeIndex] += 1;
        }
      });
      return counts;
    }

    /**
     * @param {string} kind
     * @param {number} typeIndex
     * @param {ResultSolution | null | undefined} solution
     * @returns {TypeAvailabilitySummary}
     */
    function getTypeAvailabilitySummary(kind, typeIndex, solution) {
      const isService = kind === "service";
      const types = isService
        ? (state.resultContext?.params?.serviceTypes ?? [])
        : (state.resultContext?.params?.residentialTypes ?? []);
      const usedCounts = countPlacementsByType(
        isService ? solution?.serviceTypeIndices : solution?.residentialTypeIndices,
        types.length
      );
      const totalAvailable = getTypeTotalAvailable(types[typeIndex], isService);
      const used = usedCounts[typeIndex] ?? 0;
      return {
        totalAvailable,
        used,
        remaining: Math.max(0, totalAvailable - used)
      };
    }

    return Object.freeze({
      countPlacementsByType,
      getTypeTotalAvailable,
      getTypeAvailabilitySummary
    });
  }

  const availabilityGlobal =
    /** @type {Window & { PlannerResultAvailability?: unknown }} */
    (globalObject);

  availabilityGlobal.PlannerResultAvailability = Object.freeze({
    createPlannerResultAvailabilityHelpers
  });
})(window);
