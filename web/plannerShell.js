(function attachPlannerShell(globalObject) {
  function createPlannerShellController(options) {
    const {
      state,
      elements,
      callbacks,
    } = options;
    const {
      hasSelectedBuilding,
      readExpansionCandidateFlags,
    } = callbacks;

    function getOptimizerLabel(optimizer) {
      if (optimizer === "cp-sat") return "CP-SAT";
      if (optimizer === "lns") return "LNS";
      return "Greedy";
    }

    function syncActionAvailability() {
      const { hasAnyCandidate } = readExpansionCandidateFlags();
      const selectedBuildingActive = Boolean(hasSelectedBuilding());
      const comparisonBusy = state.expansionAdvice.isRunning;
      const editorBusy = state.isSolving || state.layoutEditor.isApplying || comparisonBusy;

      elements.solveButton.disabled = state.isSolving || comparisonBusy;
      elements.solveButton.textContent = state.isSolving ? "Solving..." : "Run solver";
      elements.stopSolveButton.disabled = !(state.isSolving && state.activeSolveRequestId && !state.isStopping);
      elements.loadConfigButton.disabled = state.isSolving || comparisonBusy;
      elements.loadLayoutButton.disabled = state.isSolving || comparisonBusy;
      elements.saveLayoutButton.disabled = state.isSolving || comparisonBusy || !state.result || !state.resultContext;
      elements.lnsUseDisplayedSeed.disabled = editorBusy;
      elements.cpSatUseDisplayedHint.disabled = editorBusy;
      elements.expansionNextService.disabled = editorBusy || state.expansionAdvice.isRunning;
      elements.expansionNextResidential.disabled = editorBusy || state.expansionAdvice.isRunning;
      elements.compareExpansionButton.disabled =
        editorBusy
        || state.expansionAdvice.isRunning
        || !state.result
        || !state.resultContext
        || !hasAnyCandidate;

      if (elements.moveSelectedBuildingButton) {
        elements.moveSelectedBuildingButton.disabled =
          editorBusy || !state.result || !state.resultContext || !selectedBuildingActive;
      }
      if (elements.removeSelectedBuildingButton) {
        elements.removeSelectedBuildingButton.disabled =
          editorBusy || !state.result || !state.resultContext || !selectedBuildingActive;
      }
      if (elements.layoutEditModeToggle) {
        for (const button of elements.layoutEditModeToggle.querySelectorAll("button")) {
          button.disabled = editorBusy || !state.result || !state.resultContext;
        }
      }
      for (const button of elements.remainingServiceList?.querySelectorAll?.("button[data-action]") ?? []) {
        button.disabled = editorBusy || !state.result || !state.resultContext;
      }
      for (const button of elements.remainingResidentialList?.querySelectorAll?.("button[data-action]") ?? []) {
        button.disabled = editorBusy || !state.result || !state.resultContext;
      }
    }

    function setSolveState(message) {
      elements.solveStatus.textContent = message;
      syncActionAvailability();
    }

    return {
      getOptimizerLabel,
      setSolveState,
      syncActionAvailability,
    };
  }

  globalObject.CityBuilderShell = Object.freeze({
    createPlannerShellController,
  });
})(window);
