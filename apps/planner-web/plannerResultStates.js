/**
 * @param {Window & { PlannerResultStates?: unknown }} globalObject
 */
(function attachPlannerResultStates(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {{ result: JsonObject | null, resultElapsedMs: number, resultError: string, resultIsLiveSnapshot: boolean, selectedMapBuilding: JsonObject | null, selectedMapCell: JsonObject | null }} ResultState
   * @typedef {{ formatElapsedTime: (ms: number) => string }} StateHelpers
   * @typedef {{ clearResultOverlay: () => void, renderExpansionAdvice: () => void, renderGreedyDiagnostics: (solution: JsonObject | null) => void, renderLayoutEditorControls: () => void, renderSelectedBuildingDetail: (solution: JsonObject | null) => void }} StateCallbacks
   * @typedef {{ state: ResultState, elements: JsonObject, helpers: StateHelpers, callbacks: StateCallbacks }} StateOptions
   */

  /**
   * @param {StateOptions} options
   */
  function createPlannerResultStateRenderer(options) {
    const { state, elements, helpers, callbacks } = options;
    const { formatElapsedTime } = helpers;
    const {
      clearResultOverlay,
      renderExpansionAdvice,
      renderGreedyDiagnostics,
      renderLayoutEditorControls,
      renderSelectedBuildingDetail
    } = callbacks;

    function resetResultMap() {
      elements.resultMapGrid.innerHTML = "";
      delete elements.resultMapGrid.dataset.cols;
      clearResultOverlay();
      renderSelectedBuildingDetail(null);
      renderLayoutEditorControls();
      renderExpansionAdvice();
    }

    function renderError() {
      state.resultIsLiveSnapshot = false;
      state.selectedMapBuilding = null;
      state.selectedMapCell = null;
      elements.resultsEmpty.hidden = true;
      elements.resultsContent.hidden = false;
      elements.resultBadge.textContent = "Error";
      elements.resultBadge.className = "result-badge error";
      elements.validationNotice.className = "notice error";
      elements.validationNotice.textContent = state.resultError;
      elements.resultPopulation.textContent = "0";
      elements.resultRoadCount.textContent = "0";
      elements.resultServiceCount.textContent = "0";
      elements.resultResidentialCount.textContent = "0";
      elements.resultElapsed.textContent = formatElapsedTime(state.resultElapsedMs);
      elements.resultSolverStatus.textContent = "failed";
      if (elements.resultProgressSummary) {
        elements.resultProgressSummary.textContent = "The solve failed before a performance history could be shown.";
      }
      if (elements.resultProgressLog) {
        elements.resultProgressLog.innerHTML = "<li>No performance samples are available.</li>";
      }
      elements.serviceResultList.innerHTML = "<li>No service placements available.</li>";
      elements.residentialResultList.innerHTML = "<li>No residential placements available.</li>";
      elements.remainingServiceList.innerHTML = "<li>No service availability to show.</li>";
      elements.remainingResidentialList.innerHTML = "<li>No residential availability to show.</li>";
      renderGreedyDiagnostics(null);
      resetResultMap();
    }

    function renderEmpty() {
      state.resultIsLiveSnapshot = false;
      state.selectedMapBuilding = null;
      state.selectedMapCell = null;
      elements.resultsEmpty.hidden = false;
      elements.resultsContent.hidden = true;
      elements.resultBadge.textContent = "Waiting";
      elements.resultBadge.className = "result-badge idle";
      elements.resultElapsed.textContent = "00:00";
      if (elements.resultProgressSummary) {
        elements.resultProgressSummary.textContent = "Run the solver to start recording a performance log.";
      }
      if (elements.resultProgressLog) {
        elements.resultProgressLog.innerHTML = "";
      }
      elements.remainingServiceList.innerHTML = "<li>No service availability to show.</li>";
      elements.remainingResidentialList.innerHTML = "<li>No residential availability to show.</li>";
      renderGreedyDiagnostics(null);
      resetResultMap();
    }

    return Object.freeze({
      renderEmpty,
      renderError
    });
  }

  const statesGlobal = /** @type {Window & { PlannerResultStates?: unknown }} */ (globalObject);
  statesGlobal.PlannerResultStates = Object.freeze({
    createPlannerResultStateRenderer
  });
})(window);
